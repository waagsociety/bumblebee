var _ = require( 'underscore' ),
		async = require( 'async' ),
		transformField = require( './transformField' );

//transform the given entity and input values
//return one (or more) object that consists of key value pairs for each field
//or undefined if entity was not valid
//returns two copies of the object:
//the first is used for validation
//the second contains resultcodes for each field
function transformEntity( entityName, entity, context, cb ) {

  // map the fields to their transformed counterparts
  return async.map( Object.keys( entity ), transformEntityField, fieldsTransformed );

  function transformEntityField( fieldName, cb, container, parentFieldName ) {
    if( [
      'bb_subProperty',
      'bb_order',
      'bb_skipCondition',
      'bb_splitCondition',
      'bb_entityType',
      'bb_description'
    ].indexOf( fieldName ) > -1 ) return cb();

    var field = entity[fieldName] || container[fieldName];
    if(!field.bb_subProperty) return transformField( fieldName, field, context, cb );
    else return async.map( Object.keys( field ), _.partial( transformEntityField, _, _, field, fieldName ), subPropertiesCollectedCb );

    function subPropertiesCollectedCb(err, results){ //weird.. gets called with [err, [err, results...]]. so send this way
      results.shift(); //get rid of err on results;

      var fieldContainer = {},
          reduced = results.reduce( normalize, {} );

      fieldContainer[fieldName] = reduced;

      cb( null, fieldContainer );
    }
  }

  function fieldsTransformed( err, fields ){
    var reduced = fields.reduce( normalize, {} );

    return cb( err, reduced );
  }

  function normalize(previousValue, currentValue){
    var keys = currentValue && Object.keys( currentValue ),
        key = keys && keys.length && keys.pop();

    if( key ) previousValue[key] = currentValue[key];

    return previousValue;
  }
}

module.exports = transformEntity;
