/**
 * made to mimic jquery's $( element ).parents( selector ) functionality,
 * traverses up the tree to find parent element
 * extends html Element
 */
if( this.Element ) ( function( ElementPrototype ){
	ElementPrototype.bbQuerySelectorParent = function( selector ){
		var element = this,
				match;

		while( element && !match ){
			match = element.matches( selector ) && element;

			element = element.parentNode;
		}

		if( match ) return match;
	};
} )( Element.prototype );
