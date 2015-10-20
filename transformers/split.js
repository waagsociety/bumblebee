//split the value to a list
//comma separated
exports.transform = function (context, data) {
	if( data !== undefined && data.constructor === Array && data[0] != undefined) {
	  	return data[0].split(',');
	}

	return new Error('split: invalid data passed, data: ' + JSON.stringify( data ) );
};
