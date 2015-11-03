// subtracts x from y
exports.transform = function (context, data, argument) {
	if( data === undefined ) return new Error('subtract: no data passed' );

	var split = argument.split(','),
			xProp = split[0],
			yProp = split[1],
			x = +data[xProp],
			y = +data[yProp];

	return x - y;
};
