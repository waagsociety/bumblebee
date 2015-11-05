// todo: allow nested properties to be accessed

module.exports.transform = function getSiblingProperty( context, data, argumentString ) {
	var split = argumentString.split('.'),
			entityName = split.shift();

	// maybe the entityName contained an escaped dot and needs to be expanded
	while( entityName[ entityName.length - 1] === '\\' ){
		entityName = entityName.slice( 0, entityName.length - 1 ) + '.' + split.shift();
	}

	var propertyName = split.shift(),
			sibling = context.currentEntities[entityName],
			value = sibling && sibling[propertyName];

	if(!sibling) return new Error('getSiblingProperty: sibling not found with name ' + entityName);

	return value;
};
