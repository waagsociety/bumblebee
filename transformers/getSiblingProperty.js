// todo: allow nested properties to be accessed

module.exports.transform = function getSiblingProperty( context, data, argumentString ) {
	console.log(context);
	var split = argumentString.split(','),
			entityName = split.shift(),
			propertyName = split.shift(),
			sibling = context.currentEntities[entityName],
			value = sibling && sibling[propertyName];

	if(!sibling) return new Error('getSiblingProperty: sibling not found with name ' + entityName);

	return value;
};
