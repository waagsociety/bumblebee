module.exports.transform = function returnPropertyFromObject(data, context, propertyName){
	if( !data || !data[propertyName] ) return new Error('returnPropertyFromObject: no data or no data.' + propertyName + ' passed, data: ' + JSON.stringify( data ) );

	return data[propertyName];
};
