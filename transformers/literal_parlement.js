var ResultCode = require('../resultCode');

exports.transform = function (context, data) {
	return {
		value: 'PARLIAMENT',
		resultcode: ResultCode.OK
	};
};
