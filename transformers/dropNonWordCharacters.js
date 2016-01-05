module.exports.transform = function( context, data ) {
	return data.replace(/\W/g, '');
};
