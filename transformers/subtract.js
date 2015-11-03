// subtracts x from y
exports.transform = function (context, data, argument) {
	if( data === undefined ) return new Error('subtract: no data passed' );

	var split = argument.split(','),
			xProp = split[0],
			yProp = split[1],
			x = +data[xProp],
			y = +data[yProp];

	if( isNaN(x) ) return new Error('subtract: first operand is not a number, key: ' + xProp + ', data: ' + JSON.stringify( data ) );
	if( isNaN(y) ) return new Error('subtract: first operand is not a number, key: ' + yProp + ', data: ' + JSON.stringify( data ) );

	return x - y;
};
