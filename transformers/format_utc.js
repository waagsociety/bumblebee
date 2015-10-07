var ResultCode = require('../resultCode');

//format a date value as utc
exports.transform = function (context, data) {
	var string;

	if(data && data instanceof Date) string = data.toISOString();

	return {
		value: string,
		resultcode: ResultCode.OK
	};
};
