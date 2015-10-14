var _ = require('underscore'),
		async = require('async'),
		asyncMapHash = require('async-maphash');

var bb = require('./bb.js'),
		server = require('./server.js'),
		files = require('./files.js');

module.exports.server = server;
module.exports.bb = bb;
module.exports.files = files;
module.exports.environment = {
	updateAllDatasets: updateAllDatasets,
	loadDataset: loadDataset,
	startTime: new Date(),
	transform: bb.transform
};

var env = module.exports.environment;

updateAllDatasets();
updateAllMappings();
loadSchemas();

function updateAllDatasets(cb){
	return async.waterfall([
		_.partial(files.getFolders, ['data']),
		getDataFilesProperties,
		setDatasetsOnEnvironment
	], cb || function(err, dSets){ console.log(err || 'all datasets loaded: ', Object.keys(dSets)) });
}

function loadDataset(filename, cb){
	return async.waterfall([
		_.partial(getDataFilesProperties, { data: [filename] }),
		setDatasetsOnEnvironment
	], cb);
}

function getDataFilesProperties(results, cb){
	return asyncMapHash.mapHash( results.data.filter( isNotHiddenFile ).map( transformPath ), files.getFileDetails, cb );

	function isNotHiddenFile( filename ) {
		return filename[0] !== '.';
	}

	function transformPath( filename ) {
		return 'data/' + filename;
	}

}

function setDatasetsOnEnvironment(files, cb){
	var dSets = env.datasets = env.datasets || {};
	Object.keys(files).forEach(setOnDataSets);

	function setOnDataSets(key){
		var split = key.split('/');
		split.shift();
		var filename = split.join('/');
		dSets[filename] = files[key];
	}

	cb(null, dSets);
}

function updateAllMappings(cb){
	return async.waterfall([
		_.partial(files.getFolders, ['mappings']),
		setMappingsOnEnvironment
	], cb || function(err, dSets){ console.log(err || 'all mappings loaded: ', dSets) });
}

function setMappingsOnEnvironment(container, cb){
	var mappings = env.mappings = container.mappings;
	cb();
}

function loadSchemas(cb){
	return async.waterfall([
		_.partial(files.getFolders, ['schemas']),
		setSchemasOnEnvironment
	], cb || function(err, dSets){ console.log(err || 'all schemas loaded: ', dSets) });
}

function setSchemasOnEnvironment(container, cb){
	var schemas = env.schemas = container.schemas;
}

function chainLogger(identifier){
	return function(){
		var allArgumentsButLast = [];
		Array.prototype.push.apply(allArgumentsButLast, arguments);
		var cb = allArgumentsButLast.pop();

		console.log(identifier || 'chainLogger:', allArgumentsButLast);
		allArgumentsButLast.unshift(null);
		cb.apply(null, allArgumentsButLast);
	}
}