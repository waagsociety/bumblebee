var ResultCode = require('../resultCode');

//split the value to a list
//comma separated
exports.transform = function (context, data) {
	if( data != undefined && data.constructor === Array && data[0] != undefined) {
	  	return {
	  		resultcode: ResultCode.OK,
	  		value: data[0].split(',')
	  	};
	}

	return {
		resultcode: ResultCode.FAIL,
		value: data
	};
};
