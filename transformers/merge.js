var ResultCode = require('../resultCode');

//merge all fields by joining with a space
exports.transform = function (context, data) {
	return {
		value: data.join(" "),
		resultcode: ResultCode.OK
	};
};
