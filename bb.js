#!/usr/bin/env node

var fs = require( 'fs' ),
  async = require( 'async' ),
  byline = require( 'byline' ),
  YAML = require( 'js-yaml' ),
  validate = require( 'jsonschema' ).validate,
  csv = require( 'csv' ),
  csvParser = require('./csv_parse'),
  uuid = require('node-uuid'),
  _ = require( 'underscore' ),
  dumbstore = require('dumbstore'),
  stableStringify = require('json-stable-stringify');

var log = true;

//Result resultcodes
ResultCode = {
  OK : 0, //transformation went okay, no errors
  FAIL : 1,//transformation failed
  DUPLICATE : 2 //transformation indicates duplicate key
};

var transformers = require( './transformers/' );

//start the streaming transformation process 
//provide paths to the configuration files and input
//cb is called at every transformed row
//this function may be called from web application for example
function transformFile( path_schema, path_mapping, path_data, bucket, done ) {
  var filesToRead = {
        path_schema: path_schema,
        path_mapping: path_mapping,
        path_data: path_data
      },
      filesContents = {},
      context = {},
      allEntities = [],
      entitiesWithRevisionPending = {},
      revisedEntitiesStore = dumbstore.getStore( 'KeyValueStore', 'revised-entities' ),
      collectedRevisionsCb;

  // enables received revisions to be processed
  bucket.onReceiveEdit( receiveEdit );

  return async.waterfall([
    _.partial( async.each, Object.keys( filesToRead), readFile ),
    parseFiles,
    extractEntities,
    collectRevisedEntities
  ], _.partial( done, _, allEntities ) );

  function readFile( key, cb ) {
    return fs.readFile( filesToRead[key], 'utf8', setFileRef );

    function setFileRef( err, contents ) {
      filesContents[key] = contents;
      cb( err );
    }
  }

  function parseFiles( cb ) {
    //process schema definitions, create tables if necessary  
    var schema = YAML.safeLoad( filesContents.path_schema ),
        mapping = YAML.safeLoad( filesContents.path_mapping ),
        parsedFile = csvParser( filesContents.path_data );

    context.schema = schema;
    context.mapping = mapping;
    context.parsedFile = parsedFile;

    setImmediate( _.partial( cb, null, context ) );
  }

  function extractEntities( context, cb ) {
    return async.eachSeries( context.parsedFile.objects, extractEntitiesFromObject, cb );

    function extractEntitiesFromObject( object, cb ) {
      context.dataByColumnName = object;
      context.currentEntities = {};

      return async.mapSeries( context.mapping, createEntity, entitiesCreated );

      function createEntity(entityContainer, cb) {
        var keys = Object.keys( entityContainer ),
            entityName = keys[0],
            entityDefinition = entityContainer[entityName];

        // set on context for use by transformer
        context.entityName = entityName;
        context.entityType = entityDefinition.entityType;

        return async.waterfall( [
          _.partial( transformEntity, entityName, entityDefinition, context ),
          addEntityToCurrentEntities,
          validateEntity
        ], cb );

        function addEntityToCurrentEntities( transformedEntity, cb ) {
          context.currentEntities[entityName] = transformedEntity;

          cb(null, transformedEntity);
        }

        function validateEntity( transformedEntity, cb ) {
          //schema for the given entity
          var schema = context.schema[ context.entityType ] || context.schema[entityName];

          if(!schema) return cb( new Error( 'schema not found for ' + entityName ) );

          //validate according to schema
          var validateResult = validate( transformedEntity, schema );

          transformedEntity.isValid = validateResult.valid;
          
          if(!transformedEntity.isValid) transformedEntity.validationErrors = validateResult.errors;

          transformedEntity.sourceData = object;
          transformedEntity.schema = schema;
          transformedEntity.mapping = entityDefinition;

          cb( null, transformedEntity );
        }
      }

      function entitiesCreated( err, entities ) {
        var invalidFound = false;

        entities.forEach(evaluateValidity);

        if(!invalidFound){
          allEntities.push.apply( allEntities, entities.map( stripExtraProps ) );
        } else {

          // first check revised entities store for previously revised entities with same csv data
          var stored = revisedEntitiesStore.get( stableStringify( entities[ 0 ].sourceData ) );
          if( stored === 'rejected' ) return cb();
          if( stored ){
            stored = JSON.parse( stored );
            allEntities.push.apply( allEntities, stored );
            return cb();
          }

          var revisionId = uuid.v4(),
              transportContainer = {
                revisionId: revisionId,
                sourceData: entities[0].sourceData, // we take the csv data from the first entity because it's the same for all of them
                entities: entities.map( createTransportableEntity )
              };

          entitiesWithRevisionPending[revisionId] = transportContainer;

          bucket.requestEdit( transportContainer );
        }

        return cb();

        function evaluateValidity( entity ){
          invalidFound = invalidFound || !entity.isValid;
          delete entity.isValid;
        }

        function stripExtraProps( entity ){
          delete entity.sourceData;
          delete entity.schema;
          delete entity.mapping;
          delete entity.validationErrors;

          return entity;
        }

        function createTransportableEntity( entity ){
          var schema = entity.schema,
              mapping = entity.mapping,
              errors = {},
              validationErrors = entity.validationErrors;

          delete entity.sourceData;
          delete entity.schema;
          delete entity.mapping;
          delete entity.validationErrors;

          Object.keys( entity ).forEach( _.partial( getErrorAndPruneIt, entity ) );
          
          return {
            mapping: mapping,
            schema: schema,
            originalValues: entity,
            currentValues: entity,
            key: 'k' + uuid.v4(),
            errors: errors,
            validationErrors: validationErrors
          };

          function getErrorAndPruneIt( entity, key ){
            var value = entity[key];

            if( value instanceof Error ){
              errors[key] = value.message;
              entity[key] = '';
            }

            // do for nested properties
            if( typeof value === 'object') Object.keys( value ).forEach( _.partial( getErrorAndPruneIt, value ) );
          }
        }
      }
    }
  }

  function collectRevisedEntities( cb ) {
    if( !Object.keys( entitiesWithRevisionPending ).length ) return cb();

    collectedRevisionsCb = cb;
  }

  function receiveEdit(editType, data, cb, afterReceivedSubscriber ) {
    var originalData = entitiesWithRevisionPending[ data.revisionId ],
        sourceData = originalData.sourceData;

    // if we're listening to incoming revisions for any reason, go there first, then come back here
    if(receiveSubscriber && !afterReceivedSubscriber) return receiveSubscriber( editType, data, entitiesWithRevisionPending[ data.revisionId ], _.partial( receiveEdit, editType, _, cb, true ) );

    var sourceDataString = stableStringify( sourceData );

    if( editType === 'dismiss' ) {
      
      revisedEntitiesStore.add( sourceDataString, 'rejected' );
      delete entitiesWithRevisionPending[data.revisionId];
    
    } else {
      
      var originalItems = entitiesWithRevisionPending[data.revisionId],
          entities = data.entities,
          entityKeys = Object.keys(data.entities),
          anyItemsAreInvalid = entityKeys.map(checkIfEntityIsInvalid).reduce( keepFalse, true );

      if( anyItemsAreInvalid ) return;

      Array.prototype.push.apply( allEntities, entityKeys.map( getEntity ) );
      revisedEntitiesStore.add( sourceDataString, JSON.stringify( Object.keys( entities ).map( function( key ){ return entities[ key ]; } ) ) );
      delete entitiesWithRevisionPending[data.revisionId];

    }

    if( !Object.keys( entitiesWithRevisionPending ).length ){
      collectedRevisionsCb();
    }

    return cb();

    function checkIfEntityIsInvalid(entityKey){
      var newEntity = entities[entityKey],
          originalEntity;

      originalItems.entities.forEach( getOriginalEntity );

      return !validate( originalEntity.schema, entities[entityKey] ).valid;

      function getOriginalEntity( currentEntity ) {
        if(currentEntity.key === entityKey) originalEntity = currentEntity;
      }
    }

    function keepFalse(previous, current){
      return previous ? current : previous;
    }

    function getEntity( entityName ){
      return entities[entityName];
    }
  }
}

//transform the given entity and input values
//return one (or more) object that consists of key value pairs for each field
//or undefined if entity was not valid
//returns two copies of the object:
//the first is used for validation
//the second contains resultcodes for each field
function transformEntity( entityName, entity, context, cb ) {

  // map the fields to their transformed counterparts
  return async.map( Object.keys( entity ), transformEntityField, fieldsTransformed );

  function transformEntityField( fieldName, cb, container, parentFieldName ) {
    if( fieldName === 'subProperty' ) return cb();

    var field = entity[fieldName] || container[fieldName];
    if(!field.subProperty) return transformField( fieldName, field, context, cb );
    else return async.map( Object.keys( field ), _.partial( transformEntityField, _, _, field, fieldName ), subPropertiesCollectedCb );

    function subPropertiesCollectedCb(err, results){ //weird.. gets called with [err, [err, results...]]. so send this way
      results.shift(); //get rid of err on results;

      var fieldContainer = {},
          reduced = results.reduce( normalize, {} );

      fieldContainer[fieldName] = reduced;

      cb( null, fieldContainer );
    }
  }

  function fieldsTransformed( err, fields ){
    var reduced = fields.reduce( normalize, {} );

    return cb( err, reduced );
  }

  function normalize(previousValue, currentValue){
    var key = Object.keys( currentValue ).pop();
    previousValue[key] = currentValue[key];

    return previousValue;
  }
}

//execute the given chain of transformers and input values
//return a key value pair: fieldName -> transformed value
function transformField( fieldName, field, context, cb ) {
  var columns = field.input,
      data = {},
      errorFound;

  // set on context for use by transformer
  context.fieldName = fieldName;

  if( columns && columns.length ) {
    //collect the input value(s)
    if( columns.length === 1 ) {
      data = getColumnData( columns[ 0 ] );
    } else {
      columns.forEach( setColumnDataOnData );
    }
  }

  if( !field.transformer || !field.transformer.length ) return passData();

  //execute the transformers chained together, input of the second is output of the first and so on
  return async.eachSeries( field.transformer, applyTransformation, passData );

  function getColumnData( columnName ) {
    return context.dataByColumnName[ columnName ];
  }

  function setColumnDataOnData( columnName ) {
    data[ columnName ] = getColumnData( columnName );
  }

  function applyTransformation(transformerName, cb){
    if( errorFound || data instanceof Error ) {
      errorFound = true;
      return setImmediate( cb );
    }

    var transformerArguments = [context, data];

    if( transformerName.indexOf( '(' ) > -1 ) {
      var result = /\((.+)\)/.exec( transformerName ),
        transformerParameter = result && result[1];

      transformerName = transformerName.split( '(' )[0];

      if( transformerParameter ){
        transformerArguments.push( transformerParameter );
      }
    }

    transformerArguments.push( transformerCb );

    var transformer = transformers[transformerName];

    if( !transformer ) throw( 'transformer ' + transformerName + ' not found' );
    
    data = transformer.apply( null, transformerArguments );
    
    // synchronous transformers return data and don't call cb
    if( data || data !== undefined ) {
      setImmediate( cb );
    }

    function transformerCb(err, passedData){
      if( err ) return cb( err );

      data = passedData;

      cb();
    }
  }

  function passData(err){
    if(!data) console.log( 'no data' );

    var fieldContainer = {};
    fieldContainer[fieldName] = data;

    cb( err, fieldContainer );
  }
}

var postProcessor,
    schemaPath,
    receiveSubscriber;

function setPostProcessor(fun){
  postProcessor = fun;
}

function setSchemaPath(path){
  schemaPath = 'schemas/' + path;
}

function setReceiveSubscriber(fun){
  receiveSubscriber = fun;
}

function transform(dataset, mapping, bucket){
  var mappingPath = 'mappings/' + mapping,
      dataPath = 'data/' + dataset;
  
  var rowsProcessed = 0;
  var sentFirstRow = false;
  
  return transformFile(schemaPath, mappingPath, dataPath, bucket, finishCb);

  function finishCb( err, results ) {
    if(err) return done(err);
    
    console.log('yay, writing output');

    if(postProcessor){
      return postProcessor(results, done);
    }

    return done(null, { write: [{
      fileSuffix: '.json',
      contents: JSON.stringify(results, null, 2)
    }] });

    function done(err, data){
      if( !data || !data.write ) return bucket.complete(err);

      writeFiles( data.write, _.partial( bucket.complete.bind( bucket ), _, data.write.map( makeOutputLink ) ) );
    }

    function writeFiles(files, cb){
      return async.parallel( files.map( createWriteFunction ), cb );

      function createWriteFunction( fileContainer ) {
        return _.partial( fs.writeFile, './output/' + dataset + fileContainer.fileSuffix, fileContainer.contents );
      }
    }

    function makeOutputLink( fileContainer ){
      return '/output/' + dataset + fileContainer.fileSuffix;
    }

  }
}

module.exports = {
  transformField : transformField,
  transformFile: transformFile,
  transform: transform,
  setPostProcessor: setPostProcessor,
  setSchemaPath: setSchemaPath,
  setReceiveSubscriber: setReceiveSubscriber
};

function exitLog(){
  console.log.apply(console, arguments);
  process.exit();
}
