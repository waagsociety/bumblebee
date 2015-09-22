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
	startTime: new Date()
};

var env = module.exports.environment;

updateAllDatasets();

function updateAllDatasets(cb){
	return async.waterfall([
		_.partial(files.getFolders, ['data']),
		chainLogger(),
		getDataFilesProperties,
		setOnEnvironment
	], cb || function(err, dSets){ console.log(err || 'all datasets loaded: ', dSets) });
}

function loadDataset(filename, cb){
	return async.waterfall([
		_.partial(getDataFilesProperties, { data: [filename] }),
		setOnEnvironment
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

function setOnEnvironment(files, cb){
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