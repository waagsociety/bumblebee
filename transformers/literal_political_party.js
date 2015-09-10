var ResultCode = require('../resultCode');

exports.transform = function (context, data) {
	return {
		value: 'POLITICAL PARTY',
		resultcode: ResultCode.OK
	};
};
