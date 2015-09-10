var ResultCode = require('../resultCode');

//format a date value as utc
exports.transform = function (context, data) {
	return {
		value: data.toISOString(),
		resultcode: ResultCode.OK
	};
};
