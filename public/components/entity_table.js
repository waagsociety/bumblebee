if(React == undefined) //when not included in browser
{
	var React = require('react');
	var EntityRow = require('./entity_row').EntityRow;
}

var EntityTable = React.createClass({displayName: "EntityTable",
		render: function() { 
			return (
				React.createElement("table", {id: this.props.title, className: "formdata"}, 
					React.createElement("caption", null, this.props.description), 
					React.createElement("tr", {id: "header"}, 
						
							this.props.fields.map(function(field){
								return React.createElement("th", {key: field}, field);
							})
						
					), 
					
						//loop through entities in state
						this.props.entities.map(function(entity){
							return React.createElement(EntityRow, {class: entity.class, columns: entity.columns, values: entity.values, status: entity.status, key: entity.key});
						})
					
				)
		);}
});

//transform a schema object to a properties object for the entity table
function entityTableProps(input)
{
	var def = input[Object.keys(input)[0]];
	var props = {
		"title" : def.title,
		"description" : def.description,
		"fields" : Object.keys(def.properties),
		"entities" : [],//passed in as initial state
		"key" : def.title
	};
	return props;	
}

if(module == undefined){ //when called from node
}
else
{
	module.exports = {
		EntityTable : EntityTable,
		entityTableProps : entityTableProps
	};

}
