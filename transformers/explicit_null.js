var ResultCode = require('../resultCode');

exports.transform = function (context, data) {
	return {
		resultcode: ResultCode.OK,
		value: "Null"
	};
};
