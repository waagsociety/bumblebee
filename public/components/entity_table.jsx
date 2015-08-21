if(React == undefined) //when not included in browser
{
	var React = require('react');
	var EntityRow = require('./entity_row').EntityRow;
}

var EntityTable = React.createClass({
		render: function() { 
			return (
				<table id={this.props.title} className="formdata">
					<caption>{this.props.description}</caption>
					<tr id="header">
						{
							this.props.fields.map(function(field){
								return <th key={field}>{field}</th>;
							})
						}
					</tr>
					{
						//loop through entities in state
						this.props.entities.map(function(entity){
							return <EntityRow class={entity.class} columns={entity.columns} values={entity.values} status={entity.status} key={entity.key} />;
						})
					}
				</table>
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
