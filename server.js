var fs = require( 'fs' ),
    path = require( 'path' ),
    express = require( 'express' ),
    http = require( 'http' ),
    path = require( 'path' ),
    bodyParser = require( 'body-parser' ),
    gzippo = require( 'gzippo' ),
    socketio = require( 'socket.io' ),
    editbuckets = require( './editbucket' ),
    uuid = require( 'node-uuid' ),
    _ = require( 'underscore' );

var cwd = process.cwd();

var transformationsInProgress = [];

var mimeTypes = {
      'json': 'application/json',
      'ndjson': 'application/x-ndjson'
    };

//var applyRoutes = require('./hoprouter.js').applyRoutes;

module.exports = {
  init: function( options, environment, callback ) {
    var env = environment;

    var uploadFolders = options.uploadFolders || {
          dataset: cwd + '/data'
        },
        uploadRedirects = {
          dataset: function( filename, cb ){
            environment.loadDataset( filename, callback );

            function callback(err){
              if( err ) return cb( '/error/' + err.message );
              
              cb( '/datasets/' + filename );
            }
          }
        },
        app = express();

    app.use( require( 'connect-busboy' )() );

    app.use( formHandler );

    app.getView = function( path, viewName ){
      this.get( path, renderView );

      function renderView( req, res ){
        res.render( viewName );
      }
    };

    app.alias = function( path, redirectRule ){
      this.get( path, function( req, res, next ){
        if( typeof redirectRule === 'string' ){
          return res.redirect( redirectRule );
        }
        if( typeof redirectRule === 'function' ){
          return res.redirect( redirectRule( req.url ) );
        }

        return next();
      });
    };

    app.set( 'views', __dirname + '/views' );
    app.set( 'view engine', 'jade' );

    app.use( bodyParser.urlencoded() );

    //app.use( require( 'less-middleware' )( __dirname + '/public' ) );
    app.use( express.static( path.join( __dirname, 'public' ) ) );

    if( fs.existsSync( cwd + '/public' ) ) {
      app.use( express.static( path.join( cwd, 'public' ) ) );
      var files = fs.readdirSync( cwd + '/public' );

      env.additionalStylesheets = files.filter( function( filename ){ return filename.indexOf( '.css' ) > -1; } );
      env.additionJavascripts = files.filter( function( filename ){ return filename.indexOf( '.js' ) > -1; } );
    }

    app.use( setLocals );
    
    app.getView( '/', 'index' );

    app.getView( '/mappings', 'mappings' );
    app.getView( '/schemas', 'schemas' );

    app.alias( '/datasets', '/' );
    app.getView( '/datasets/:filename', 'dataset' );
    app.get( '/datasets/:filename/transform/:mapping', transformFile );

    app.get( '/output/:filename', sendOutputFile );

    var server = app.listen( options.port || 3000, function() {
      var address = server.address();
      console.log( "Express server listening" );
      console.log( address );
    });

    var io = socketio( server );

    io.on( 'connection', function( socket ) {
      console.log('a user connected');

      socket.on( 'error', console.error.bind( console, 'socket error' ) );

      socket.on( 'socketkey', function( socketKey ) {
        console.log( 'transformkey: ', socketKey );

        var bucket = editbuckets.getBucket( socketKey );

        bucket.addSubscriber( sendRequestEdit, socket.id );

        bucket.onComplete( function( err, files ) {
          socket.emit( 'complete', { error: err, files: files } );
        }, socket.id );

        socket.on( 'disconnect', function() {
          bucket.clearSubscriptions( socket.id );
        } );
      } );

      function sendRequestEdit(data) {
        socket.emit( 'requestedit', data );
      }

      function getNextRevision( err, bucket, data ) {
        socket.emit( 'remove', data.revisionId );

        bucket.addSubscriber( sendRequestEdit, socket.id );
      }

      // reject all
      socket.on( 'dismiss', function( data ) {
        var bucket = editbuckets.getBucket( data.socketKey );
        bucket.receiveEdit( 'dismiss', data, _.partial( getNextRevision, _, bucket, data ) );
      } );

      // approve all
      socket.on( 'rectify', function( data ) {
        var bucket = editbuckets.getBucket( data.socketKey );
        bucket.receiveEdit( 'rectify', data, _.partial( getNextRevision, _, bucket, data ) );
      });
    });


    return callback( null, app, server );

    function setLocals( req, res, next ){
      res.locals.env = environment;
      res.locals.req = req;
      next();
    }

    function formHandler( req, res, next ){
      if( !req.busboy ) return next();

      req.busboy.on( 'file', function( fieldname, file, filename, encoding, mimetype ) {
        var folder = uploadFolders[ fieldname ];

        if( !folder ) return next();

        var destination = folder + '/' + filename,
            fstream = fs.createWriteStream( destination );

        file.pipe( fstream );
        
        fstream.on( 'error', function( error ) {
          return callback( error );
        } );

        return fstream.on( 'close', function() {
          return callback( null );
        } );

        function callback( err ){
          if( err ) return res.status( 400 ).send( err.message );

          uploadRedirects[ fieldname ]( filename, res.redirect.bind( res ) );
        };
      });

      //req.busboy.on( 'field', console.log.bind( console, 'field' ) );
      req.pipe( req.busboy );
    }

    function transformFile( req, res, next ) {
      var dataset = req.params.filename,
          mapping = req.params.mapping;

      if( !env.datasets[ req.params.filename ] || env.mappings.indexOf( req.params.mapping ) === -1 ) return next();
      
      var socketKey = req.params.filename + '-' + req.params.mapping;

      var bucket = editbuckets.getBucket( socketKey );

      res.render( 'transform', {
        socketKey: socketKey
      } );

      if( ~transformationsInProgress.indexOf( socketKey ) ){
        return; //already transforming
      }

      transformationsInProgress.push( socketKey );

      env.transform( dataset, mapping, bucket );
    }

    function sendOutputFile( req, res, next ) {
      var filename = 'output/' + req.params.filename,
          extension = req.params.filename.split( '.' ).pop(),
          contentType = req.query.raw ? 'text/plain' : mimeTypes[ extension ] || 'text/plain';

      return fs.exists( filename, function( exists ) {
        if( !exists ) return next( 'not found' );

        return fs.stat( filename, function( err, stat ) {
          if( err ) return next( err );

          res.writeHead( 200, {
            'Content-Type': contentType,
            'Content-Length': stat.size
          } );

          fs.createReadStream( filename ).pipe( res );
        } );
      } );
    }
  }
};
