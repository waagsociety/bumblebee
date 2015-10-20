//format a date value as utc
exports.transform = function (context, data) {
	if( data && data instanceof Date ) return data.toISOString();

	return new Error( 'format_utc: data is not a Date, data: ' + JSON.stringify( data ) );
};
