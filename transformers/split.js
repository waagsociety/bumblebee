//split the value to a list
//comma separated
exports.transform = function (context, data, argument) {
  if( data !== undefined && typeof data === 'string' ) {
    return data.split( argument || ',' );
  }

  return new Error('split: invalid data passed, data: ' + JSON.stringify( data ) );
};
