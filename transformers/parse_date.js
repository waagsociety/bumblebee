var ResultCode = require('../resultCode');

//parse a date value 
exports.transform = function (context, data) {
	return {
		value: new Date(data),
		resultcode: ResultCode.OK
	};
};
