var async = require('async');

var transformers = require( './transformers/' );

//execute the given chain of transformers and input values
//return a key value pair: fieldName -> transformed value
function transformField( fieldName, field, context, cb ) {
  var columns = field.input,
      data = {},
      errorFound;

  // set on context for use by transformer
  context.fieldName = fieldName;
  context.currentInput = field.input;

  if( columns && columns.length ) {
    //collect the input value(s)
    if( columns.length === 1 ) {
      data = getColumnData( columns[ 0 ] );
    } else {
      columns.forEach( setColumnDataOnData );
    }
  }

  if( !field.transformer || !field.transformer.length ) return passData();

  //execute the transformers chained together, input of the second is output of the first and so on
  return async.eachSeries( field.transformer, applyTransformation, passData );

  function getColumnData( columnName ) {
    return context.dataByColumnName[ columnName ];
  }

  function setColumnDataOnData( columnName ) {
    data[ columnName ] = getColumnData( columnName );
  }

  function applyTransformation(transformerName, cb){
    // todo implement context.isFulfilled so transformers can indicate that their output is final and no further transformers need to be called. or a similar method.
    if( errorFound || data instanceof Error ) {
      errorFound = true;
      return setImmediate( cb );
    }

    var transformerArguments = [context, data];

    if( transformerName.indexOf( '(' ) > -1 ) {
      var result = /\((.+)\)/.exec( transformerName ),
        transformerParameter = result && result[1];

      transformerName = transformerName.split( '(' )[0];

      if( transformerParameter ){
        transformerArguments.push( transformerParameter );
      }
    }

    transformerArguments.push( transformerCb );

    var transformer = transformers[transformerName];

    if( !transformer ) throw( 'transformer ' + transformerName + ' not found' );
    
    data = transformer.apply( null, transformerArguments );
    
    // synchronous transformers return data and don't call cb
    if( data || data !== undefined ) {
      setImmediate( cb );
    }

    function transformerCb(err, passedData){
      if( err ) return cb( err );

      data = passedData;

      cb();
    }
  }

  function passData(err){
    if(!data) console.log( 'no data' );

    var fieldContainer = {};
    fieldContainer[fieldName] = data;

    cb( err, fieldContainer );
  }
}

module.exports = transformField;
