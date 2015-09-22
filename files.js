var fs = require('fs'),
	_ = require('underscore'),
	async = require('async'),
	filesize = require('filesize'),
	asyncMapHash = require('async-maphash');

module.exports.getFolders = _.partial(asyncMapHash.mapHash, _, fs.readdir);

module.exports.getFileDetails = getFileDetails;

function getFileDetails(path, cb){
	return async.waterfall([
		_.partial(async.parallel, {
			contents: _.partial(fs.readFile, path, 'utf8'),
			stats: _.partial(fs.stat, path)
		}),
		gotInfo
	], cb);
	
	function gotInfo(results, cb){
		var container = {};
		container.entries = results.contents.split('\n').length;
		container.modified = results.stats.mtime;
		container.size = filesize(results.stats.size);
		cb(null, container);
	}
}