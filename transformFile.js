var _ = require( 'underscore' ),
    fs = require('fs'),
    async = require( 'async' ),
    dumbstore = require('dumbstore'),
    YAML = require( 'js-yaml' ),
    stableStringify = require('json-stable-stringify'),
    csvParser = require('./csv_parse'),
    validate = require( 'jsonschema' ).validate,
    uuid = require('node-uuid'),
    transformEntity = require( './transformEntity' );

var receiveSubscriber;

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
        mapping = YAML.safeLoad( filesContents.path_mapping );

    context.schema = schema;
    context.mapping = mapping;

    return csvParser( filesContents.path_data, collectParsedFile );

    function collectParsedFile( err, parsedFile ) {
      context.parsedFile = parsedFile;

      cb( err, context );
    }
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

function setReceiveSubscriber( fun ){
  receiveSubscriber = fun;
}

module.exports = {
  transformFile : transformFile,
  setReceiveSubscriber: setReceiveSubscriber
};