//hello world react component. Used for finding a good way to set up unit testing
var React = require('react');

var Hello = React.createClass({displayName: "Hello",  
		render: function() {
			return React.createElement("div", null, "Hello ", this.props.name);
		}
});

module.exports.Hello = Hello;
