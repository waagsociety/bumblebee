var fs = require('fs'),
	_ = require('underscore');

fs.readdirSync( __dirname ).forEach( _.partial( registerTransformer, __dirname + '/' ) );

if( fs.existsSync('./transformers') ) {
	fs.readdirSync('./transformers').forEach( _.partial( registerTransformer, process.cwd() + '/transformers/' ) );
}

function registerTransformer( folder, fileName ) {
	var name = fileName.split( '.' );
	name.pop();
	name = name.join( '.' );
	if( name !== 'index' ){
		module.exports[name] = require( folder + fileName ).transform;
	}
}