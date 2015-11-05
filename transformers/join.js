//join the values if inside array, otherwise copy the value
exports.transform = function ( context, data, joinCharacter ) {
	return data != undefined && data.constructor === Array ?
			data.join( typeof joinCharacter === 'string' && joinCharacter || ',') :
			data;
};
