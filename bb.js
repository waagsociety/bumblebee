#!/usr/bin/env node

var fs = require( 'fs' ),
  async = require( 'async' ),
  byline = require( 'byline' ),
  YAML = require( 'js-yaml' ),
  validate = require( 'jsonschema' ).validate,
  csv = require( 'csv' ),
  sqlite3 = require( 'sqlite3' ).verbose(),
  _ = require( 'underscore' );

var log = true;

//Result resultcodes
ResultCode = {
  OK : 0, //transformation went okay, no errors
  FAIL : 1,//transformation failed
  DUPLICATE : 2 //transformation indicates duplicate key
};

var delimiters = [',', '.', ':', ';', '|', '$', '/', '\\', '-', '_', '`', '~', '\'', '"'];

var relationTypes = [
      'tnl:same', 'tnl:parent', 'tnl:related', 'tnl:member', 'tnl:boardmember', 'tnl:commissioner', 'tnl:advisor', 'tnl:employee', 'tnl:lobbyist'
    ],
    relationWhitelist = ['id', 'type', 'from', 'to', 'data'],
    pitWhitelist = ['id', 'type', 'name', 'data'];

function getDelimiter(line){
  return delimiters.map(function(character){
    return {
      items: line.split(character),
      delimiter: character
    };
  }).sort(function(a, b){
    return a.items.length - b.items.length;
  }).pop().delimiter;
}

// for now have in memory cache only
var cache = {};

var transformers = require( './transformers/' );

//start the streaming transformation process 
//provide paths to the configuration files and input
//cb is called at every transformed row
//this function may be called from web application for example
function transformFile( path_schema, path_mapping, path_data, cb, done ) {
  var filesToRead = {},
      filesContents = {},
      context = {
        cache: cache
      };

  filesToRead.path_schema = path_schema;
  filesToRead.path_mapping = path_mapping;

  async.each( Object.keys( filesToRead ), readFile, afterFilesRead);

  return context;

  function readFile( key, cb ) {
    return fs.readFile( filesToRead[key], 'utf8', setFileRef );

    function setFileRef( err, contents ) {
      filesContents[key] = contents;
      cb( err );
    }
  }

  function afterFilesRead( err ) {
    if( err ) return cb( err );

    //process schema definitions, create tables if necessary  
    var schema = YAML.safeLoad( filesContents.path_schema ),
        mapping = YAML.safeLoad( filesContents.path_mapping ),
        //stream = byline( fs.createReadStream( path_data, { encoding: 'utf8' } ) ),
        header = undefined;//the first line of data is expected to be a header

    
    context.cache = cache;
    context.schema = schema;
    context.mapping = mapping;

    var pendingLines = 0,
        ended = false,
        allEntities = [];

    //start data processing
    // stream.on( 'data', processData );

    // stream.on( 'end', end );
    
    return fs.readFile(path_data, 'utf8', function(err, contents){
      if(err) return done(err);

      var parsedFile = require('./csv_parse')(contents);
      
      async.eachSeries(parsedFile.objects, function(object, cb){
        context.dataByColumnName = object;

        return processRow(context, lineDone);

        function lineDone( err, entities ){
          if( err ) console.log( err );

          allEntities.push.apply( allEntities, entities );
          cb( err, entities );
        }
      }, _.partial( done, _, allEntities ) );
    });

    return;

    function processData( line ) {
      if( header == undefined ) {
        context.delimiter = getDelimiter(line);

        header = line.split( context.delimiter );
        context.header = header;

        return cb( null, { header: header } );
      }

      pendingLines++;

      return csv.parse( line, { delimiter: context.delimiter }, csvParseCb);
    }

    function csvParseCb( err, output ) {
      if(err) return done(err);
      var data = output[0];

      context.dataByColumnName = {};
      context.header.forEach(setDataByColumnName);

      processRow( context, lineDone );

      function setDataByColumnName(key, index){
        context.dataByColumnName[key] = data[index];
      }
    }

    function lineDone( err, entities ) {
      if( err ) console.log( err );

      pendingLines--;
      allEntities.push.apply( allEntities, entities );

      cb( err, entities );
      
      //if( ended && !pendingLines && done ) done( null, allEntities );
    }

    function end(){
      ended = true;
      if(!pendingLines) done(null, allEntities);
    }
  }
}

//process one row at a time, according to the specified mapping
//for each entity in the mapping file, transform the data, 
//validate the transformed data with the schema.
function processRow(context, cb) {
  return async.map( context.mapping, convertEntity, entitiesConverted );

  function convertEntity(entityContainer, cb){
    var keys = Object.keys( entityContainer ),
        entityName = keys[0],
        entity = entityContainer[entityName];

    // set on context for use by transformer
    context.entityName = entityName;

    transformEntity(entityName, entity, context, entityConverted);

    function entityConverted(err, convertedEntity){
      //schema for the given entity
      var schema = context.schema[entityName];

      ignoreSchema = false;
      //validate according to schema
      if( !ignoreSchema && !isValid( schema, convertedEntity[0] ) ){
        return cb();
      }

      //if(log) console.log( "create: " + JSON.stringify( convertedEntity ) );

      cb( null, convertedEntity[1] );
    }
  }

  function entitiesConverted( err, results ) {
    results = _.compact( results );

    cb( err, results.length ? results : undefined );
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
    var objectToValidate = {},
        objectAnnotated = {};

    fields.forEach( declareObject );

    return cb(err, [objectToValidate, objectAnnotated]);

    function declareObject( fieldData ){
      var keys = Object.keys( fieldData );
      
      keys.splice( keys.indexOf( 'resultCode' ), 1 );
      
      var key = keys[0];

      objectToValidate[key] = fieldData[key];
      objectAnnotated[key] = fieldData;
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

quickConvert('TblParlementLoopbaan-modified', 'parlement_loopbaan.yaml', console.log.bind('test completed'));

function quickConvert(dataset, mapping, cb){
  var schemaPath = 'schemas/tnl_schema.yaml',
      mappingPath = 'mappings/' + mapping,
      dataPath = 'data/' + dataset;
  
  var rowsProcessed = 0;
  var sentFirstRow = false;
  
  return transformFile(schemaPath, mappingPath, dataPath, progressCb, finishCb);

  function progressCb( err, entities ) {
    exitLog('progressCb', entities);
    ++rowsProcessed;

    if(!(rowsProcessed % 64)) console.log('done ' + rowsProcessed + ', another sixtyfour');
    else if(!(rowsProcessed % 32)) console.log('done ' + rowsProcessed + ',another thirtytwo');
    else if(!(rowsProcessed % 16)) console.log('done ' + rowsProcessed + ',another sixteen');
    else if(!(rowsProcessed % 8)) console.log('done ' + rowsProcessed + ',another eight');
    
    if(!entities.header && !sentFirstRow){
      sentFirstRow = true;
      cb(err, entities);
    }
  }

  function finishCb( err, results ) {
    if(err) return done(err);
    
    console.log('yay, writing output');

    var pits = [],
        relations = [];

    results.forEach(putInBucket);

    //transform from and to on relations to IDs of referenced items
    relations = relations.map(setFromToToIds);

    return async.parallel([
      _.partial(fs.writeFile, './output/' + dataset + '-pits.ndjson', pits.join('\n')),
      _.partial(fs.writeFile, './output/' + dataset + '-relations.ndjson', relations.join('\n')),
    ], done);

    function putInBucket( entity ){
      var flattenedEntity = flattenEntity( entity ),
          isRelation = ( relationTypes.indexOf( flattenedEntity.type ) > -1 ),
          type = isRelation ? 'relation' : 'pit',
          bucket = isRelation ? relations : pits;

      flattenedEntity = enforceFormatting(flattenedEntity, isRelation ? relationWhitelist : pitWhitelist);

      var typeCache = cache[type + 's'] = cache[type + 's'] || {},
          uniqueIdentifier = isRelation ?
            ( flattenedEntity.from + '-' + flattenedEntity.to ) :
            flattenedEntity.name;

      if(typeCache[uniqueIdentifier]) return;

      typeCache[uniqueIdentifier] = flattenedEntity;
      bucket.push( JSON.stringify( flattenedEntity ) );
    }

    function setFromToToIds(relation){
      var objRelation = JSON.parse(relation);
      
      objRelation.from = cache.pits[objRelation.from].id;
      objRelation.to = cache.pits[objRelation.to].id;

      return JSON.stringify(objRelation);
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
    flattenedEntity[key] = entity[key][key] || entity[key];
  }
}

function enforceFormatting(entity, whitelist){
  Object.keys(entity).forEach(function(key){
    if(whitelist.indexOf(key) === -1){
      entity.data = entity.data || {};
      entity.data[key] = entity[key];
      delete entity[key];
    }
  });
  return entity;
}

//validates according to json-schema
function isValid( schema, object ) {
  var result = validate( object, schema );

  if( result.valid == false && log ) {
    console.log( "INVALID: " + result.schema.title + ": " + result.errors[0].stack );
    console.log( object );
    console.log( "\n" );
  }

  return result.valid;
}

module.exports = {
  transformField : transformField,
  // createTableStatement: createTableStatement,
  // createInsertStatement: createInsertStatement,
  transformFile: transformFile,
  quickConvert: quickConvert
};

function exitLog(){
  console.log.apply(console, arguments);
  process.exit();
}