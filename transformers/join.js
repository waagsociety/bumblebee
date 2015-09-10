var ResultCode = require('../resultCode');

//join the values if inside array, otherwise copy the value
exports.transform = function (context, data) {
	return {
		value: data != undefined && data.constructor === Array && data.length > 0 ?
			data.join(',') : data,
		resultCode: ResultCode.OK
	};
};
