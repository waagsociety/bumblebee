#!/usr/bin/env node

var fs = require( 'fs' ),
  async = require( 'async' ),
  byline = require( 'byline' ),
  _ = require( 'underscore' );

var log = true;

var transformFileModule = require('./transformFile');

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
  transformFileModule.setReceiveSubscriber( fun );
}

function transform(dataset, mapping, bucket){
  var mappingPath = 'mappings/' + mapping,
      dataPath = 'data/' + dataset;
  
  var rowsProcessed = 0;
  var sentFirstRow = false;
  
  return transformFileModule.transformFile(schemaPath, mappingPath, dataPath, bucket, finishCb);

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
  transform: transform,
  setPostProcessor: setPostProcessor,
  setSchemaPath: setSchemaPath,
  setReceiveSubscriber: setReceiveSubscriber
};

function exitLog(){
  console.log.apply(console, arguments);
  process.exit();
}
