var shortId = require('shortId');

//generate a unique id, by means of the shortid npm module
exports.transform = function (context, data) {
	return shortId.generate();
};
