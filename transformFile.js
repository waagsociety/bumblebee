var _ = require( 'underscore' ),
    fs = require('fs'),
    async = require( 'async' ),
    aStackRunner = require('astackrunner'),
    crypto = require('crypto'),
    dumbstore = require('dumbstore'),
    YAML = require( 'js-yaml' ),
    stableStringify = require('json-stable-stringify'),
    csvParser = require( 'csvparse2objects' ),
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
      }, bucket.statusUpdate.bind( bucket ), 500 ),
      forcedComplete;

  // enables received revisions to be processed
  bucket.onReceiveEdit( receiveEdit );

  bucket.onForceComplete( forceComplete );

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
      if( forcedComplete ) return;
      context.dataByColumnName = object;
      context.currentEntities = {};

      var skipRecord;

      context.mapping.forEach( handleSkipAndSplitConditions );

      if( skipRecord ) return cb();

      return async.mapSeries( context.mapping, createEntity, entitiesCreated );

      function handleSkipAndSplitConditions( entityContainer ) {
        var keys = Object.keys( entityContainer ),
            entityName = keys[0],
            entityDefinition = entityContainer[entityName],
            skipCondition = entityDefinition.bb_skipCondition,
            splitCondition = entityDefinition.bb_splitCondition,
            inputValue, split, doubles,
            valueMatches, regexMatches;

        if( splitCondition ){
          inputValue = context.dataByColumnName[ splitCondition.input ];
          
          valueMatches = splitCondition.value && splitCondition.value === inputValue;
          regexMatches = splitCondition.regex && new RegExp( splitCondition.regex ).exec( inputValue );

          if( valueMatches || regexMatches ) {
            split = splitCondition.newValues || inputValue.split( new RegExp( splitCondition.regex ) );

            if( splitCondition.unique ) {
              split = split.filter( indexMatchesPredicate );
            }

            doubles = split.map( createDoubleFromValue );

            context.dataByColumnName = doubles.shift();
            stackRunner.add( doubles );
            status.sourceItemsTotal += doubles.length;
          }
        }

        if( skipCondition ){
          inputValue = context.dataByColumnName[ skipCondition.input ];

          valueMatches = skipCondition.value && ( typeof skipCondition.value === 'object' ? skipCondition.value.indexOf( inputValue ) > -1 : skipCondition.value === inputValue );
          regexMatches = skipCondition.regex && new RegExp( skipCondition.regex, 'i' ).exec( inputValue );

          if( valueMatches || regexMatches ) {
            status.sourceItemsAutoProcessed++;
            skipRecord = true;
            return;
          }
        }

        function indexMatchesPredicate( value, i, array ) {
          return array.indexOf( value ) === i;
        }

        function createDoubleFromValue( value ){
          var item = _.extend( {}, context.dataByColumnName );
          item[ splitCondition.input ] = value;
          return item;
        }
      }

      function createEntity( entityContainer, cb ) {
        var keys = Object.keys( entityContainer ),
            entityName = keys[0],
            entityDefinition = entityContainer[entityName];

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
          var schema = context.schema[ context.entityType ],
              validationResult;

          if(!schema) return cb( new Error( 'schema not found for ' + entityName ) );

          if( !context.markNextAsInvalid ) {
            //validate according to schema
            validationResult = validate( transformedEntity, schema );

            transformedEntity.isValid = validationResult.valid;
            
            if(!transformedEntity.isValid) transformedEntity.validationErrors = validationResult.errors;
          } else {
            // transformers can indicate something is not dependable and the entity will need to be checked by the user
            transformedEntity.isValid = false;
            delete context.markNextAsInvalid;
          }

          transformedEntity.schema = schema;
          transformedEntity.mapping = entityDefinition;
          
          if( entityDefinition.optional ) transformedEntity.optional = true;
          transformedEntity.entityType = context.entityType;

          cb( null, transformedEntity );
        }
      }

      function entitiesCreated( err, entities ) {

        if( err ){
          if( err.message === 'skipCondition' ){
            status.sourceItemsAutoProcessed++;
            return cb();
          } else return cb( err );
        }

        var invalidFound = false,
            invalidOptionalEntities = [];

        if( _.filter( entities, function( entity ){ return !entity; } ).length ) console.log( context.currentEntities, entities );
        
        entities.forEach(evaluateValidity);

        while( invalidOptionalEntities.length ) {
          entities.splice( entities.indexOf( invalidOptionalEntities.pop() ), 1 );
        }

        if(!invalidFound){
          allEntities.push.apply( allEntities, entities.map( stripExtraProps ) );

          status.sourceItemsAutoProcessed++;
          status.targetItemsAutoProcessed += entities.length;
          status.targetItemsTotal = allEntities.length;
        } else {

          // first check revised entities store for previously revised entities with same csv data
          var hash = stableHash( context.dataByColumnName ),
              stored = revisedEntitiesStore.get( hash );

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
                sourceData: context.dataByColumnName, // we take the csv data from the first entity because it's the same for all of them
                entities: entities.map( createTransportableEntity )
              };

          entitiesWithRevisionPending[revisionId] = transportContainer;

          bucket.requestEdit( transportContainer );

          status.sourceItemsWaiting++;
        }

        return cb();

        function evaluateValidity( entity, index ){
          if( !entity.optional ) invalidFound = invalidFound || !entity.isValid;
          else if( !entity.isValid ) invalidOptionalEntities.push( entity );
          delete entity.isValid;
        }

        function stripExtraProps( entity ){
          delete entity.schema;
          delete entity.mapping;
          delete entity.validationErrors;
          delete entity.entityType;
          delete entity.optional;

          return entity;
        }

        function createTransportableEntity( entity ){
          var schema = entity.schema,
              mapping = entity.mapping,
              entityType = entity.entityType,
              errors = {},
              validationErrors = entity.validationErrors;

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
      if( forcedComplete || !Object.keys( entitiesWithRevisionPending ).length && !stackRunner.length ) {
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

    var hashed = stableHash( sourceData );

    if( editType === 'dismiss' ) {
      status.sourceItemsReceived++;
      status.sourceItemsWaiting--;
      
      revisedEntitiesStore.add( hashed, 'rejected' );
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
      revisedEntitiesStore.add( hashed, JSON.stringify( Object.keys( entities ).map( function( key ){ return entities[ key ]; } ) ) );
      
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

  function forceComplete(){
    forcedComplete = true;

    storePendingItems();

    collectedRevisionsCb();
  }

  function storePendingItems() {
    var header = Object.keys( entitiesWithRevisionPending[ Object.keys( entitiesWithRevisionPending )[ 0 ] ].sourceData ),
        entitiesToStore = [],
        filename;

    Object.keys( entitiesWithRevisionPending ).forEach( extractSourceData );

    filename = path_data + '-unprocessed.csv';

    return fs.writeFile( filename, entitiesToStore.join( '\n' ), 'utf8' );

    function extractSourceData( key ) {
      var item = entitiesWithRevisionPending[ key ],
          list = [];
      
      header.forEach( extractValue );
      entitiesToStore.push( list.join( ',' ) );

      function extractValue( key ) {
        list.push( item.sourceData[ key ] );
      }
    }
  }

  function reEvaluateEntitiesWithRevisionPending(){
    status.sourceItemsWaiting -= bucket.requestBus.length;

    // dump the old entitiesWithRevisionPending or it will overflow and cause memory issues
    var newEntitiesWithRevisionsPending = {};

    bucket.outstandingRevisions.forEach( function( outstandingRevision ) {
      var revisionId = outstandingRevision.item.revisionId;
      newEntitiesWithRevisionsPending[ revisionId ] = entitiesWithRevisionPending[ revisionId ];
    } );

    entitiesWithRevisionPending = newEntitiesWithRevisionsPending;

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

function stableHash( object ) {
  return crypto.createHash( 'md5' ).update( stableStringify( object ) ).digest( 'hex' );
}

module.exports = {
  transformFile : transformFile,
  setReceiveHandlers: setReceiveHandlers
};
