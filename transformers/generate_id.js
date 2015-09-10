var ResultCode = require('../resultCode'),
	shortId = require('shortId');


//generate a unique id, by means of the shortid npm module
exports.transform = function (context, data) {
	return {
		value: shortId.generate(),
		resultcode: ResultCode.OK
	};
};
