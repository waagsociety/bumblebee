var fs = require('fs'),
		express = require('express'),
    http = require('http'),
    path = require('path'),
    bodyParser = require('body-parser'),
    gzippo = require('gzippo');

var cwd = process.cwd();

//var applyRoutes = require('./hoprouter.js').applyRoutes;

module.exports = {
  init: function( options, environment, callback ) {
  	var env = environment;

  	var uploadFolders = options.uploadFolders || {
					dataset: cwd + '/data'
				},
				uploadRedirects = {
					dataset: function( filename, cb ){
						environment.loadDataset(filename, callback);

						function callback(err){
							if(err) return cb('/error/' + err.message);
							
							cb('/datasets/' + filename);
						}
					}
				},
  			app = express();

		app.use( require( 'connect-busboy' )() );

		app.use(formHandler);

  	app.getView = function( path, viewName ){
  		this.get( path, renderView );

  		function renderView( req, res ){
  			res.render( viewName );
  		}
  	};

  	app.alias = function( path, redirectRule ){
  		this.get( path, function(req, res, next){
  			if(typeof redirectRule === 'string'){
  				return res.redirect( redirectRule );
  			}
  			if(typeof redirectRule === 'function'){
  				return res.redirect( redirectRule( req.url ) );
  			}

  			return next();
  		});
  	}

		app.set( 'views', __dirname + '/views' );
		app.set( 'view engine', 'jade' );

		app.use( bodyParser.urlencoded() );

		//app.use( require( 'less-middleware' )( __dirname + '/public' ) );
		app.use( express.static( path.join( __dirname, 'public' ) ) );
		//app.use( gzippo.staticGzip( path.join( __dirname, 'public' ), { contentTypeMatch: /text|javascript|json|svg|ttf|otf|css/ } ) );

		app.use( setLocals );
		
		app.getView( '/', 'index' );

		app.getView('/mappings', 'mappings');
		app.getView('/schemas', 'schemas');

		app.alias('/datasets', '/');
		app.getView('/datasets/:filename', 'dataset');
		app.get('/datasets/:filename/quickconvert/:mapping', function(req, res, next){
			var dataset = req.params.filename,
					mapping = req.params.mapping;

					console.log(dataset, mapping, env.datasets, env.mappings);

			if(!env.datasets[req.params.filename] || env.mappings.indexOf(req.params.mapping) === -1) return next();
			
			env.quickConvert(dataset, mapping, function(err, results){
				if(err) return res.status(500).send(err);
console.log(results);
				res.json(results);
			});
		});

	  var server = app.listen(options.port || 3000, function(){
	  	var address = server.address();
	    console.log( "Express server listening" );
	    console.log( address );
	  });

	  return callback(null, app, server);

	  function setLocals(req, res, next){
			res.locals.env = environment;
			res.locals.req = req;
			next();
		}

		function formHandler(req, res, next){
			if(!req.busboy) return next();

			req.busboy.on('file', function( fieldname, file, filename, encoding, mimetype ){
				var folder = uploadFolders[fieldname];

				if(!folder) return next();

				var destination = uploadFolders[fieldname] + '/' + filename,
						fstream = fs.createWriteStream( destination );

	      file.pipe(fstream);
	      
	      fstream.on('error', function(error) {
	        return callback(error);
	      });

	      return fstream.on('close', function() {
	        return callback(null);
	      });

				function callback( err ){
					if(err) return res.status( 400 ).send( err.message );

					uploadRedirects[fieldname]( filename, res.redirect.bind(res) );
  			};
			});

			//req.busboy.on('field', console.log.bind(console, 'field'))
			req.pipe(req.busboy);
		}
  }
};