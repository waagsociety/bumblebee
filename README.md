###Bumblebee data transformer in the skies

How to use:

create/modify `package.json`
(to create you can use `npm init` command)

add bumblebee under dependencies like this:

```{

	...

	"dependencies": {

		"bumblebee": "https://github.com/waagsociety/bumblebee"

	}

}```

then `npm install`

`var bb = require('bumblebee');`


###Vision

Bumblebee is meant as a tool to cleanup and format data, from csv to ndjson.
it all starts with a source file. One uploads a csv file to the web interface, it's processed with the use of a mapping file (in yaml format) and checked againt a schema file (also in yaml format). Every unique transformation is then presented to the user to allow changes to be made and remembered for next times. After all transformations have been checked and corrected, the output file can be downloaded.

###Status
Currently transforming is implemented with the mapping file, as well as schemas. Still to be done:

-web interface

--upload to web interface

--prompting the user for confirmations and corrections, storing these

-ability to split into two records from within a transformation (key)

-storing corrections for future use for same dataset


future:
-schema and mapping editor
