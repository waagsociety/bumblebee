var ResultCode = require('../resultCode');

//split the value to a list
//comma separated
exports.transform = function (context, data, argument) {
	if( data === undefined || isNaN( data.length ) ) throw('data passed is no array (takeItemFromArray): ' + data);

	var index = parseInt( argument );

	if( isNaN( index ) ) {
		throw('argument passed is not a number (takeItemFromArray): ' + argument)
	}
	
	if( index < 0 ) {
		index = Math.min( data.length + index, data.length );
	}
	
  	return {
  		value: data[index],
  		resultcode: ResultCode.OK
  	};
};
