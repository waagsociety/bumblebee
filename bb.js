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

          ignoreSchema = false;

          //validate according to schema
          transformedEntity.isValid = isValid( schema, transformedEntity );

          if( !transformedEntity.isValid ){
            transformedEntity.sourceData = object;
            transformedEntity.schema = schema;
          }

          cb( null, transformedEntity );
        }
      }

      function entitiesCreated( err, entities ) {
        var validEntities = [];

        entities.forEach(function(entity){
          if(entity.isValid){
            delete entity.isValid;
            validEntities.push(entity);
            return;
          }

          delete entity.isValid;

          var sourceData = entity.sourceData,
              schema = entity.schema;

          delete entity.sourceData;
          delete entity.schema;

          var requiredKeys = Object.keys(entity),
              revisionId = uuid.v4(),
              transportableEntity = {
                schema: schema,
                requiredKeys: requiredKeys,
                sourceData: sourceData,
                currentValues: entity,
                revisionId: revisionId
              };

          entitiesWithRevisionPending[revisionId] = transportableEntity;

          bucket.requestEdit( transportableEntity );
        });

        allEntities.push.apply(allEntities, validEntities);

        cb( err );
      }
    }
  }

  function collectRevisedEntities( cb ) {
    if( !Object.keys( entitiesWithRevisionPending ).length ) return cb();

    collectedRevisionsCb = cb;
  }

  function receiveEdit(editType, data, cb){
    console.log('receiveEdit', editType, data, cb.toString());
    
    if( editType === 'dismiss' ) {
      delete entitiesWithRevisionPending[data.revisionId];
    } else {
      var item = entitiesWithRevisionPending[data.revisionId],
          itemIsValid = isValid(data.values, item.schema);

      if(!itemIsValid) return;

      allEntities.push(data.values);
      delete entitiesWithRevisionPending[data.revisionId];
    }

    cb();

    if( !Object.keys( entitiesWithRevisionPending ).length ){
      collectedRevisionsCb();
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

  function transformEntityField( fieldName, cb ) {
    transformField( fieldName, entity[fieldName], context, cb );
  }

  function fieldsTransformed( err, fields ){
    var objectToValidate = {};

    fields.forEach( declareObject );

    return cb( err, objectToValidate );

    function declareObject( fieldData ){
      var keys = Object.keys( fieldData );
      
      keys.splice( keys.indexOf( 'resultCode' ), 1 );
      
      var key = keys[0];

      objectToValidate[key] = fieldData[key];
    }
  }
}

//execute the given chain of transformers and input values
//return a key value pair: fieldName -> transformed value
function transformField( fieldName, field, context, cb ) {
  var columns = field.input,
      data = {};

  // set on context for use by transformer
  context.fieldName = fieldName;

  if( columns ) {
    //collect the input value
    data.value = columns.map( getColumnData );
  }

  //execute the transformers chained together, input of the second is output of the first and so on
  return async.eachSeries( field.transformer, applyTransformation, afterChain );

  function getColumnData( columnName ) {
    return context.dataByColumnName[ columnName ];
  }

  function applyTransformation(transformerName, cb){
    var transformerArguments = [context, data.value];

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
    if( data ) setImmediate( cb );

    function transformerCb(err, passedData){
      if( err ) return cb( err );

      data = passedData;

      cb();
    }
  }

  function afterChain(err){
    var key = fieldName,
        result = {};

    if(!data) console.log( 'no data' );

    result.resultCode = data.resultcode;
    result[key] = data.value;

    cb( err, result );
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
      return postProcessor(results, writeFiles);
    }

    return writeFiles(null, [{
      fileSuffix: dataset + '.json',
      contents: JSON.stringify(results, null, 2)
    }]);

    function writeFiles(err, files){
      return async.parallel( files.map( createWriteFunction ), done );

      function createWriteFunction( fileContainer ) {
        return _.partial( fs.writeFile, './output/' + dataset + fileContainer.fileSuffix, fileContainer.contents );
      }
    }

    function done(err){
      console.log(err || 'output written');
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
