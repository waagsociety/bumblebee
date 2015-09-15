var ResultCode = require('../resultCode');

exports.transform = function (context, data, string) {
	return {
		value: string,
		resultcode: ResultCode.OK
	};
};
