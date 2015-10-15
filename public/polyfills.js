// /**
//  * Matches Polyfill
//  * source: https://gist.github.com/jonathantneal/3062955
//  * resource: http://caniuse.com/#feat=matchesselector
//  */
// this.Element && function(ElementPrototype) {
// 	ElementPrototype.matches = ElementPrototype.matches ||
// 	ElementPrototype.matchesSelector || 
// 	ElementPrototype.mozMatchesSelector ||
// 	ElementPrototype.msMatchesSelector ||
// 	ElementPrototype.oMatchesSelector ||
// 	ElementPrototype.webkitMatchesSelector ||
// 	function (selector) {
// 		var node = this, nodes = (node.parentNode || node.document).querySelectorAll(selector), i = -1;

// 		while (nodes[++i] && nodes[i] != node);

// 		return !!nodes[i];
// 	}
// }(Element.prototype);


this.Element && function( ElementPrototype ){
	ElementPrototype.bbQuerySelectorParent = function( selector ){
		// var possibleParents = [],
		// 		match;

		// possibleParents.push.apply( possibleParents, document.querySelectorAll( selector ) );
		
		// while(possibleParents.length && !match){
		// 	match = possibleParents.pop().matches(  )
		// }
		var element = this,
				match;

		while(element && !match){
			match = element.matches( selector ) && element;

			element = element.parentNode;
		}

		if(match) return match;
	};
}( Element.prototype ); 
