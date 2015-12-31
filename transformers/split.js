//split the value to a list
//comma separated
exports.transform = function (context, data, argument) {
	if( data !== undefined && data.constructor === Array && data[0] != undefined) {
	  	return data[0].split( argument || ',' );
	}

	return new Error('split: invalid data passed, data: ' + JSON.stringify( data ) );
};
