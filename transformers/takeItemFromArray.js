// returns item from array, negative indexes are calculated from the end
exports.transform = function (context, data, argument) {
	if( data === undefined || isNaN( data.length ) ) return new Error('takeItemFromArray: data passed is no array: ' + JSON.stringify( data ) );

	var index = parseInt( argument );

	if( isNaN( index ) ) {
		return new Error('takeItemFromArray: argument passed is not a number, argument: ' + JSON.stringify( argument) );
	}
	
	if( index < 0 ) {
		index = Math.min( data.length + index, data.length );
	}
	
  return data[index];
};
