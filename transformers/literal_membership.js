var ResultCode = require('../resultCode');

exports.transform = function (context, data) {
	return {
		value: "MEMBER_OF",
		resultcode: ResultCode.OK
	};
};
