var ResultCode = require('../resultCode');

//simply copy the value
exports.transform = function (context, data) {
	return {
		value: data,
		resultCode: ResultCode.OK
	};
};
