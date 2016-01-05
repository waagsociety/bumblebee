//join the values if inside array, otherwise copy the value
exports.transform = function ( context, data, joinCharacter ) {
	joinCharacter = typeof joinCharacter === 'function' ? '' : joinCharacter;

	return data !== undefined && data.constructor === Array ?
			data.join( joinCharacter ) :
			data;
};
