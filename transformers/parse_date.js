var ResultCode = require('../resultCode');

//parse a date value 
exports.transform = function (context, data) {
	var date = new Date(data);
	if(date.toString() === 'Invalid Date'){
		console.log(data, date.toString());
	}
	return {
		value: date,
		resultcode: ResultCode.OK
	};
};
