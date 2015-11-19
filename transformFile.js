var _ = require( 'underscore' ),
    fs = require('fs'),
    async = require( 'async' ),
    aStackRunner = require('astackrunner'),
    dumbstore = require('dumbstore'),
    YAML = require( 'js-yaml' ),
    stableStringify = require('json-stable-stringify'),
    csvParser = require('./csv_parse'),
    validate = require( 'jsonschema' ).validate,
    uuid = require('node-uuid'),
    magicStatus = require('magic-status'),
    transformEntity = require( './transformEntity' );

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
      revisedEntitiesStore = dumbstore.getStore( 'KeyValueStore', 'revised-entities-' + path_data.split('/').pop() + '-' + path_mapping.split('/').pop() ),
      collectedRevisionsCb,
      stackRunner,
      status = magicStatus({
        sourceItemsTotal: 0,
        sourceItemsAutoProcessed: 0,
        sourceItemsWaiting: 0,
        sourceItemsReceived: 0,
        targetItemsTotal: 0,
        targetItemsAutoProcessed: 0,
        targetItemsReceived: 0
      }, bucket.statusUpdate.bind( bucket ), 500 );

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

      status.sourceItemsTotal = parsedFile.objects.length;

      cb( err, context );
    }
  }

  function extractEntities( context, cb ) {
    stackRunner = aStackRunner.create( 1 )
      .add( context.parsedFile.objects )
      .execute( extractEntitiesFromObject )
      .onEmpty( function( err ) {
        collectedRevisionsCb( err );
      } );

    return cb();

    function extractEntitiesFromObject( object, cb ) {
      context.dataByColumnName = object;
      context.currentEntities = {};

      return async.mapSeries( context.mapping, createEntity, entitiesCreated );

      function createEntity(entityContainer, cb) {
        var keys = Object.keys( entityContainer ),
            entityName = keys[0],
            entityDefinition = entityContainer[entityName],
            skipCondition = entityDefinition.bb_skipCondition,
            splitCondition = entityDefinition.bb_splitCondition,
            inputValue, split, doubles;

        if( skipCondition ){
          inputValue = context.dataByColumnName[ skipCondition.input ];
          if(
            ( skipCondition.value && skipCondition.value === inputValue ) ||
            ( skipCondition.regex && new RegExp( skipCondition.regex ).exec( inputValue ) )
          ) return cb();
        }

        if( splitCondition ){
          inputValue = context.dataByColumnName[ splitCondition.input ];
          if(
            ( splitCondition.value && splitCondition.value === inputValue ) ||
            ( splitCondition.regex && new RegExp( splitCondition.regex ).exec( inputValue ) )
          ) {
            split = splitCondition.newValues || inputValue.split( new RegExp( splitCondition.regex ) );
            doubles = split.map( createDoubleFromValue );

            context.dataByColumnName = doubles.shift();
            Array.prototype.push.apply( context.parsedFile.objects, doubles );
          }
        }
        // set on context for use by transformer
        context.entityName = entityName;
        context.entityType = entityDefinition.bb_entityType || entityName;

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
          var schema = context.schema[ context.entityType ];

          if(!schema) return cb( new Error( 'schema not found for ' + entityName ) );

          //validate according to schema
          var validateResult = validate( transformedEntity, schema );

          transformedEntity.isValid = validateResult.valid;
          
          if(!transformedEntity.isValid) transformedEntity.validationErrors = validateResult.errors;

          transformedEntity.sourceData = object;
          transformedEntity.schema = schema;
          transformedEntity.mapping = entityDefinition;
          transformedEntity.entityType = context.entityType;

          cb( null, transformedEntity );
        }

        function createDoubleFromValue( value ){
          var item = _.extend( {}, context.dataByColumnName );
          item[ splitCondition.input ] = value;
          return item;
        }
      }

      function entitiesCreated( err, entities ) {
        if( err ){
          if( err.message === 'skipCondition' ){
            status.sourceItemsAutoProcessed++;
            return cb();
          } else return cb( err );
        }

        var invalidFound = false;

        if( _.filter( entities, function( entity ){ return !entity } ).length ) console.log( context.currentEntities, entities );
        
        entities.forEach(evaluateValidity);

        if(!invalidFound){
          allEntities.push.apply( allEntities, entities.map( stripExtraProps ) );
          
          status.sourceItemsAutoProcessed++;
          status.targetItemsAutoProcessed += entities.length;
          status.targetItemsTotal = allEntities.length;
        } else {

          // first check revised entities store for previously revised entities with same csv data
          var stored = revisedEntitiesStore.get( stableStringify( entities[ 0 ].sourceData ) );
          if( stored === 'rejected' ) {
            status.sourceItemsAutoProcessed++;
            return cb();
          }
          if( stored ){
            stored = JSON.parse( stored );
            allEntities.push.apply( allEntities, stored );

            status.sourceItemsAutoProcessed++;
            status.targetItemsAutoProcessed += stored.length;
            status.targetItemsTotal = allEntities.length;
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

          status.sourceItemsWaiting++;
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
          delete entity.entityType;

          return entity;
        }

        function createTransportableEntity( entity ){
          var schema = entity.schema,
              mapping = entity.mapping,
              entityType = entity.entityType,
              errors = {},
              validationErrors = entity.validationErrors;

          delete entity.sourceData;
          delete entity.schema;
          delete entity.mapping;
          delete entity.validationErrors;
          delete entity.entityType;

          Object.keys( entity ).forEach( _.partial( getErrorAndPruneIt, entity ) );
          
          return {
            mapping: mapping,
            schema: schema,
            originalValues: entity,
            currentValues: entity,
            entityType: entityType,
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
    if( !stackRunner.length && !Object.keys( entitiesWithRevisionPending ).length ) return cb();
    
    collectedRevisionsCb = function( err ) {
      if( !Object.keys( entitiesWithRevisionPending ).length && !stackRunner.length ) {
        cb( err );
      }
    };
  }

  function receiveEdit(editType, data, cb, afterReceivedSubscriber ) {
    var originalData = entitiesWithRevisionPending[ data.revisionId ],
        sourceData = originalData.sourceData;

    // if we're listening to incoming revisions for any reason, go there first, then come back here
    if( receiveHandlers && !afterReceivedSubscriber && editType !== 'dismiss' ){
        return async.map( originalData.entities, function( transportEntity, cb ){
          var entityType = transportEntity.entityType,
              handler = receiveHandlers[ entityType ];
          
          if( !handler ){
            return setImmediate( cb );
          }

          handler( data.entities[ transportEntity.key ], transportEntity.schema, transportEntity.mapping, cb );
        }, _.partial( receiveEdit, editType, data, cb, true ) );
    }

    var sourceDataString = stableStringify( sourceData );


    if( editType === 'dismiss' ) {
      status.sourceItemsReceived++;
      status.sourceItemsWaiting--;
      
      revisedEntitiesStore.add( sourceDataString, 'rejected' );
      delete entitiesWithRevisionPending[data.revisionId];
    
    } else {
      
      var originalItems = entitiesWithRevisionPending[data.revisionId],
          entities = data.entities,
          entityKeys = Object.keys(data.entities),
          anyItemsAreInvalid = entityKeys.map(checkIfEntityIsInvalid).reduce( keepFalse, true );

      if( anyItemsAreInvalid ) return;
      status.sourceItemsReceived++;
      status.sourceItemsWaiting--;
      status.targetItemsReceived += entityKeys.length;

      Array.prototype.push.apply( allEntities, entityKeys.map( getEntity ) );
      revisedEntitiesStore.add( sourceDataString, JSON.stringify( Object.keys( entities ).map( function( key ){ return entities[ key ]; } ) ) );
      
      delete entitiesWithRevisionPending[data.revisionId];

      reEvaluateEntitiesWithRevisionPending();
    }

    collectedRevisionsCb();

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

  function reEvaluateEntitiesWithRevisionPending(){
    status.sourceItemsWaiting -= bucket.requestBus.length;

    // stackrunner will continue automatically when items are added
    stackRunner.add( bucket.requestBus.map( function( item ){ return item.sourceData; } ) );

    // clear all items currently in bus
    bucket.requestBus = [];

    return;
  }

}

function setReceiveHandlers( handlers ){
  receiveHandlers = handlers;
}

module.exports = {
  transformFile : transformFile,
  setReceiveHandlers: setReceiveHandlers
};
