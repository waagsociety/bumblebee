#!/usr/bin/env node

var fs = require( 'fs' ),
  async = require( 'async' ),
  byline = require( 'byline' ),
  YAML = require( 'js-yaml' ),
  validate = require( 'jsonschema' ).validate,
  csv = require( 'csv' ),
  sqlite3 = require( 'sqlite3' ).verbose(),
  csvParser = require('./csv_parse'),
  uuid = require('node-uuid'),
  _ = require( 'underscore' );

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
      collectedRevisionsCb;

  bucket.onReceiveEdit(receiveEdit);

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

      return async.map( context.mapping, createEntity, entitiesCreated );

      function createEntity(entityContainer, cb) {
        var keys = Object.keys( entityContainer ),
            entityName = keys[0],
            entityDefinition = entityContainer[entityName];

        // set on context for use by transformer
        context.entityName = entityName;

        return async.waterfall( [
          _.partial( transformEntity, entityName, entityDefinition, context ),
          validateEntity
        ], cb );

        function validateEntity( transformedEntity, cb ) {
          //schema for the given entity
          var schema = context.schema[entityName];

          if(!schema) return cb( new Error( 'schema not found for ' + entityName ) );

          //validate according to schema
          transformedEntity.isValid = isValid( schema, transformedEntity );

          transformedEntity.sourceData = object;
          transformedEntity.schema = schema;

          cb( null, transformedEntity );
        }
      }

      function entitiesCreated( err, entities ) {
        var invalidFound = false;

        entities.forEach(evaluateValidity);

        if(!invalidFound){
          allEntities.push.apply( allEntities, entities.map( stripExtraProps ) );
        } else {
          var revisionId = uuid.v4(),
              transportContainer = {
                revisionId: revisionId,
                sourceData: entities[0].sourceData,
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

          return entity;
        }

        function createTransportableEntity( entity ){
          var schema = entity.schema,
              errors = {};

          delete entity.sourceData;
          delete entity.schema;

          Object.keys( entity ).forEach( _.partial( getErrorAndPruneIt, entity ) );
          
          return {
            schema: schema,
            requiredKeys: Object.keys( entity ),
            originalValues: entity,
            currentValues: entity,
            key: 'k' + uuid.v4()
          };

          function getErrorAndPruneIt( entity, key ){
            var value = entity[key];

            if( value instanceof Error ){
              errors[key] = value;
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

  function receiveEdit(editType, data, cb){
    if( editType === 'dismiss' ) {
      delete entitiesWithRevisionPending[data.revisionId];
    } else {
      var originalItems = entitiesWithRevisionPending[data.revisionId],
          entities = data.entities,
          entityKeys = Object.keys(data.entities),
          anyItemsAreInvalid = entityKeys.map(checkIfEntityIsInvalid).reduce( keepFalse, true );

      if( anyItemsAreInvalid ) return;

      allEntities.push( Object.keys( data.entities ).map( getEntity ) );
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

      return !isValid( entities[entityKey], originalEntity.schema );

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

  if( columns ) {
    //collect the input value
    data = columns.map( getColumnData );
  }

  //execute the transformers chained together, input of the second is output of the first and so on
  return async.eachSeries( field.transformer, applyTransformation, passData );

  function getColumnData( columnName ) {
    return context.dataByColumnName[ columnName ];
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
    schemaPath;

function setPostProcessor(fun){
  postProcessor = fun;
}

function setSchemaPath(path){
  schemaPath = 'schemas/' + path;
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
      fileSuffix: dataset + '.json',
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


function flattenEntity( entity ) {
  var flattenedEntity = {};

  Object.keys( entity ).forEach( declarePropertyOnFlattenedEntity );

  return flattenedEntity;

  function declarePropertyOnFlattenedEntity( key ) {
    if( entity[key] !== undefined ) flattenedEntity[key] = entity[key][key] || entity[key];
  }
}

//validates according to json-schema
function isValid( schema, object ) {
  return validate( object, schema ).valid;
}

module.exports = {
  transformField : transformField,
  transformFile: transformFile,
  transform: transform,
  setPostProcessor: setPostProcessor,
  setSchemaPath: setSchemaPath
};

function exitLog(){
  console.log.apply(console, arguments);
  process.exit();
}
