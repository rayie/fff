var l = console.log;
var JSFTP = require("jsftp");
var die = function(msg){  console.log(msg); process.exit(); };
var spawn = require('child_process').spawn;
var fs = require('fs');

var FFF = module.exports = function(){

	var self = this;
	this.tmp_files_to_clear = [];
	/*
		universal single file mover

		examples of from values:

		local only:  			/path/to/local/file.txt

		remote with key: 		userid@host:/path/to/data/file/on/remote/file.txt

		remote with pem: 		pem:userid:/path/to/pemfile@host:/path/to/data/file/on/remote/file.txt

		remote with ftp: 		ftp:userid:pw@host:/path/to/data/file/on/remote/file.txt

	*/



	this._parse_smartpath = function(sp){

		if ( "object" == typeof sp ) 
			return sp;

		if ( -1 === sp.search(/@.*:/) ){
			//it's local
				
			return  { 
				kind: "local",
				host: "localhost",
				path: sp 
			}
		}

		var parts = sp.split(/@/);
		var remote = parts.splice(1).join("").split(/:/);
		var pkg = {
			host: remote[0],
			path: remote[1]
		};

		var creds = parts[0].split(/:/);	
		pkg.kind = creds[0];
		switch(pkg.kind){
			case "ftp": 
				pkg.user = creds[1];
				pkg.pw=creds[2]; 
				break;
			case "pem": 
				pkg.user = creds[1];
				pkg.pemfile=creds[2]; 
				break;
			default:
				pkg.user = pkg.kind.toString();
				pkg.kind = "ssh";
				break;
		}
		//l(pkg);
		return pkg;
	}



	/*
		returns a string representing a "remote" scp path argument
	*/
	this._construct_remote_scp_args = function( pkg ){
		if ( pkg.kind == "local" ) return pkg.path;
		
		return [ pkg.user, "@", pkg.host, ":", "'", pkg.path , "'" ].join("");
	}



	this._run_scp = function( scp_params, cb ){
		return self._spawn( "scp", scp_params, cb );
	}

	this._run_ssh = function( ssh_params, cb ){
		return self._spawn( "ssh", ssh_params, cb );
	}


	this._spawn = function( comm, params, cb ){ 
		var psTxt="";
		var ps_p = spawn(comm, params);
		//l("spawning: ", comm, params);
		//l(ps_p);
		ps_p.stdout.on("data",function(data){ 
			//l(psTxt);
			psTxt+=data.toString(); 
		});

		ps_p.stderr.on("data",function(data){ 
			//l(psTxt);
			psTxt+=data.toString(); 
		});
		ps_p.on("error",function(err){
			
			return cb({comm:comm, params: params, msg:"got spawn error event", err:psTxt});
		});
		ps_p.on("exit",function(code){
			if (code!==0){
				l("got spawn exit errror code: ", code);
				//error with sql
				return cb({comm:comm, params: params, msg:"got spawn exit code !== 0 ", err:psTxt});
			}
			//l(psTxt);
			return cb(null, psTxt);
		});
	}


	this._move_local_to_local = function(local_from_path, local_to_path, cb){

		if ( local_from_path == local_to_path ) return cb(null);

		l("moving local: " , local_from_path , local_to_path );
		var psTxt="";
		var ps_p = spawn('mv', [local_from_path , local_to_path]);
		ps_p.stderr.on("data",function(data){ 
			psTxt+=data.toString(); 
			//l(psTxt);
		});

		ps_p.on("exit",function(code){
			if (code!=0){
				return cb({ msg:"failed moving local to local", err: psTxt });
			}
			return cb(null);
		});
	}
	


	/*
		we have a local file as a source
		now deal with the "to"
	*/
	this._got_local_source_file = function ( path_to_local_fn,  to , cb){
		switch(to.kind){
			case "local":
				// just do a local move	
				return self._move_local_to_local( path_to_local_fn, to.path, cb );

			case "ssh":
				var scp_params = [
					path_to_local_fn,
					self._construct_remote_scp_args( to )
				];
				return self._run_scp( scp_params , cb );

			case "pem":
				var scp_params = [
					"-i", 
					to.pemfile, 
					path_to_local_fn,
					self._construct_remote_scp_args( to )
				];
				return self._run_scp( scp_params , cb );

			case "ftp":
				var jsftp = self._jsftp( to );
				return jsftp.put( path_to_local_fn, to.path, cb );
		}

	}

	this._jsftp = function(pkg){
		return new JSFTP({
			host: pkg.host,
			user: pkg.user,
			pass: pkg.pw,
			port: 21
		});
	}







	// public methods


	/* 
	params:
		req: 
			1. from_pkg|from_path
			2. to_pkg|to_path
		optional:
			3. opts 
		req:
			4. cb 
	*/
	this.copy = function( from, to, opts, cb ){
		if ("function"===typeof opts){
			cb = opts;
		}

		from = self._parse_smartpath( from );
		to = self._parse_smartpath( to );

		var to_base_name =  to.path.split(/\//g).pop();
		if ( to_base_name.search(/ /g) !== -1 ){
			to_base_name = to_base_name.replace(/ /,"_");
			var to_path_parts = to.path.split(/\//g);
			to_path_parts.pop();
			to_path_parts.push( to_base_name );
			to.path = to_path_parts.join("/");
			l("Removing space from to.path: " + to.path);
		}
		
		// we now have the from and to as pkgs
		var pat = from.kind+to.kind;

		if ( pat=="sshssh" ){  //only scenario where we can do direct remote to remote
			var scp_params = [
				"-3",
				self._construct_remote_scp_args( to ), 
				self._construct_remote_scp_args( from )
			];
			return self._run_scp( scp_params, cb );
		}

		if ( from.kind=="local" )
			return self._got_local_source_file( from.path, to, cb);

		if ( to.kind=="local" )
			var path_to_local_fn= to.path;
		else {
			var path_to_local_fn= "/tmp/"  + (new Date()).getTime().toString() + "_" + from.path.split(/\//g).pop();
			self.tmp_files_to_clear.push( path_to_local_fn );
		}

		// if [from] is remote, we have to make a local copy first
		switch(from.kind){	
			case "ssh":
				var scp_params = [
					self._construct_remote_scp_args( from ),
					path_to_local_fn
				];
				return self._run_scp( scp_params , function( err ){
					if ( err ) return cb({msg:"failed scp", scp_params:scp_params, err:err});
					self._got_local_source_file( path_to_local_fn, to, cb );
				});



			case "pem":
				var scp_params = [
					"-i", 
					from.pemfile, 
					self._construct_remote_scp_args( from ),
					path_to_local_fn
				];
				//die(scp_params);

				return self._run_scp( scp_params , function( err ){
					if ( err ) return cb({msg:"failed scp with pem ", scp_params: scp_params, err:err});
					self._got_local_source_file( path_to_local_fn, to, cb );
				});


			case "ftp":
				var jsftp = self._jsftp( from );
				return jsftp.get(from.path, path_to_local_fn, function( err ){
					if ( err ) return cb(err);
					self._got_local_source_file( path_to_local_fn, to, cb );
				});
		}

	}


	this.write = function ( data, to, cb ){
		to = self._parse_smartpath( to );
		if ( to.kind=="local" )
			return fs.writeFile(to.path, data, function(err){
				if ( err )
					return cb({ err:err, msg:"writeFile failed" });

				return cb();
			});
		
				
		var path_to_local_fn= "/tmp/"  + (new Date()).getTime().toString() + "_" + to.path.split("/").pop();
		fs.writeFile(path_to_local_fn, data, function(err){
			if ( err )
				return cb({ 
					err:err, 
					msg:"writeFile failed for local tmp by fff", 
					tmp_path: path_to_local_fn 
				});

			self.tmp_files_to_clear.push( path_to_local_fn );
			return self.copy( path_to_local_fn, to, cb);
		});

	}

	this.read = function( from, cb ){
		from = self._parse_smartpath( from );
		if ( from.kind=="local" ){
			return fs.readFile(from.path, function(err, data){
				return cb(err, data);
			});
		}

		var path_to_local_fn= "/tmp/"  + (new Date()).getTime().toString() + "_" + from.path.split("/").pop();
		self.tmp_files_to_clear.push( path_to_local_fn );
		return self.copy( from, path_to_local_fn, function(err){
			if( err )  return cb(err);

			l(path_to_local_fn);
			return fs.readFile(path_to_local_fn, cb);
		});
	}



	this.clean = function(cb){
		l("clean");
		if ( self.tmp_files_to_clear.length == 0 ) return cb(null);
		
		var fn = self.tmp_files_to_clear.pop();
		return self.del( fn, function(){ self.clean(cb); });
	}

	this.del = function( pkg , cb ){
		//l("deleting ", pkg);
		pkg = self._parse_smartpath( pkg );
		switch(pkg.kind){	
			case "local":
				l("deleting local: " + pkg.path);
				return fs.unlink( pkg.path , cb );

			case "ssh":
				var ssh_args = [ 
					"-l",
					pkg.user, 
					pkg.host, 
					"mv " + pkg.path + " /tmp/" + (new Date()).getTime()+ "_bak_" + pkg.path.split(/\//g).pop()
				];
				return self._run_ssh( ssh_args , cb );

			case "pem":
				var ssh_args = [
					"-i", 
					pkg.pemfile,
					pkg.user + "@" + pkg.host , 
					"mv " + pkg.path + " /tmp/" + (new Date()).getTime()+ "_bak_" + pkg.path.split(/\//g).pop()
				];
				//l(ssh_args);
				return self._run_ssh( ssh_args, cb );


			case "ftp":
				var jsftp = self._jsftp( pkg );
				//l(pkg.path); l(jsftp.raw);	
				return jsftp.raw["dele"](pkg.path, function( err, ftp_response ){
					if ( err ) return cb({err:err, msg:"Failed ftp delete" });
					//l(ftp_response);
					return cb(null);
				});
		}	
			
	}

	this.move = function( from, to , cb ){
		self.copy( from, to , function(err){
			if ( err ) return cb(err);

			self.del(from, cb);
		});
	}

	/*
		returns cb(err, lising_result);
	*/
	this.list = function( pkg , cb ){  //cb must handle the listing result
		//l("listing", pkg);
		pkg = self._parse_smartpath( pkg );
				
		var comm = "ls -p " + pkg.path;
		switch(pkg.kind){	
			case "local":

				return fs.readdir(pkg.path,function(err, local_filelist){
					return cb(null,local_filelist);
				});

				//return self._spawn("ls", ["-p", pkg.path ], cb);

			case "ssh":
				var ssh_args = [ 
					"-l",
					pkg.user,
					pkg.host, 
					comm	
				];
				//l(ssh_args);
				return self._run_ssh( ssh_args , cb );

			case "pem":
				var ssh_args = [
					"-i", 
					pkg.pemfile,
					pkg.user + "@" + pkg.host , 
					comm	
				];
				//l(ssh_args);
				return self._run_ssh( ssh_args, cb );


			case "ftp":
				var jsftp = self._jsftp( pkg );
				return jsftp.list(pkg.path, function( err, ftp_listing ){
					//l(err,ftp_listing);
					
					if ( err ) return cb(err);

					var ftp_listing = ftp_listing.split(/\n/g);
					ftp_listing.pop()
					var entries = [];
					for(var i = 0 ; i < ftp_listing.length; i++){
						var entry = ftp_listing[ i ];
						//die(entry);
						entry = entry.replace(/ {2}/g,"");
						if ( entry.substr(-1) == "\r" ) 
							entry = entry.substr(0, entry.length - 1 );
						if ( entry == "." || entry == ".." ){
							
						}
						else if (entry.substr(0,1) == "d"){

						}
						else{ 
							var ftp_file_entry_parts = entry.split(/ /g);
							var def_n = 7;
							for(var n = 0; n < ftp_file_entry_parts.length; n++){
								if ( ftp_file_entry_parts[n].search(/[0-9][0-9]:[0-9][0-9]/) == 0 ){
									def_n = n+1;
								}
							}
							//l( ftp_file_entry_parts );
							entries.push( ftp_file_entry_parts.slice( def_n ).join(" ") );
							//entries.push( ftp);
						}
						//l("entry: " + entry);
					}
					entries.push("");
					entries = entries.join("\n");
					//l("string of entries: " + entries);
					return cb( null, entries );	
				});
		}	
		
	}

	this.list_all = function( from, to , cb ){
		return self._multi_file( "list", from, to, cb );
	}
	this.copy_all = function( from, to , cb ){
		return self._multi_file( "copy", from, to, cb );
	}
	this.move_all = function( from, to , cb ){
		return self._multi_file( "move", from, to, cb );
	}

	this._multi_file = function( comm, from, to, cb){
		l( comm, from, to, cb);
		from = self._parse_smartpath( from );
		to = self._parse_smartpath( to );

		if ( to.path.substr(-1) !== "/" ) 
			return cb({ msg:"Destination path must be a directory, not a file", to_path: to.path });

		if ( from.path.search(/\*/g) == -1 && from.path.substr(-1)!=="/" )
			return cb({ msg:"source path must contain a wild card or end with a / to denote a directory" });
			
		if ( from.path.substr(-1) == "/" )
			var from_base_path = from.path;
		else{
			var from_path_parts =  from.path.split(/\//g);
			from_path_parts.pop(); //pop off the wild card string
			var from_base_path = from_path_parts.join("/");
			if ( from_path_parts[0] == "" )
				from_base_path = "/" + from_base_path;
			from_base_path+="/";
		}
		//l(from_base_path);

		var ff = [];
		self.list( from, function(err, listing_txt){
			if ( err ) return cb({err:err, msg:"Error listing files", from:from, to:to});
			if ( from.kind=="local" ){
				//already an array from readdir
				remote_files = listing_txt;
			}
			else{
				//l("listing_txt:",listing_txt,"--");
				var remote_files = listing_txt.split(/\n/g);
				//l(remote_files);
				remote_files.pop(); //remove empty last entry, always happens
			}

			var fns_only = []; //listing of file names only
			for(var i = 0 ; i < remote_files.length; i++ ){
				var nm = remote_files[i];
				l(nm,to);
				var _from = self._clone_pkg( from );
				_from.path = from_base_path + nm;

				var _to = self._clone_pkg( to );
				_to.path = to.path+nm;


				if (nm.substr(-1)!=="/"){ //
					ff.push({ comm: comm, from: _from,  to: _to });
				}
				//l(ff);

				fns_only.push(nm);
			}
			if ( comm=="list" ){ 
				//l(ff);	
				return cb();
			}

			self._next(ff, cb);
		});

	}

	this._clone_pkg = function(pkg){
		var o = {};
		for(var k in pkg) o[ k ] = pkg[ k ].toString()
		return o;
	}

	this._next = function( ff, cb ){
		if ( ff.length == 0 ) return cb();

		//l(ff);
		var pkg = ff.pop();
		return self[pkg.comm]( pkg.from, pkg.to, function(){ self._next( ff, cb );  });
	}
	
		


	/*
		reading files using linux find, path must be local
		fp are find params that should indcate a date cutoff
	*/

	this.find_files = function( path, fp, cb ){
		var pkg = self._parse_smartpath( path );
		var path_parts =  pkg.path.split(/\//g);
		var wc = path_parts.pop();
		//l(pkg);
		//l(path); l("path_parts:", path_parts);

		//l(pkg.path); pkg.path = pkg.path.replace(/ /g,"\\ "); l("after replace:"); l(pkg.path);

		if ( -1 !== wc.search(/\*|\./)){  //check for wild card as last segment
			//assumes that a wild card of file names provided or specific file
			pkg.path = path_parts.join("/");
			var findparams  = [ pkg.path , "-type" , "f", "-name", wc ];	
			l(pkg.path);
		}
		else var findparams  = [ pkg.path , "-type" , "f"];	
		if ( typeof fp == "string" ){
			var node_env =  ( process.env.NODE_ENV ) ? process.env.NODE_ENV : "dev"; 

			switch(fp){
				case "todaymac":
					findparams = findparams.concat([ "-mtime", "0"]);
					break;
				case "day":
				case "today":
					findparams = findparams.concat([ "-daystart", "-mtime", "0"]);
					break;
				case "week":
					findparams = findparams.concat([ "-daystart", "-mtime", "7"]);
					break;
				case "all":
					break;
				default:
					if ( fp.substr(0,7) == "daysago" ){
						var daysago = fp.substr(7); 
						if ( node_env == "local" ){
							var cmin = daysago * 24 * 60;
							findparams = findparams.concat([ "-cmin", "-"+cmin]);
						}
						else
							findparams = findparams.concat([ "-daystart", "-mtime", daysago]);
					}
					break;
			}


		}
		else{
		  var findparams = [ pkg.path ].concat( fp );
		}



		findparams = findparams.concat([ "-not", "-name", "Thumbs.db" ]);

		l(findparams);

		if ( pkg.kind == "local"){
			return self._spawn( "find", findparams, function(err,out){
				//l(err,out,findparams);
				if ( err ) return cb(err);
				if ( !out ) return cb(null,[]);

				var lines = out.split(/\n/);
				if ( lines[lines.length-1] == "" ) lines.pop();
				//l(lines);

				return cb(null,lines); //array of full paths of files
			});
		}


		//we have to do a remote find over ssh
		findparams[0] = '"'+findparams[0]+'"';
		findparams = ["find"].concat(findparams);
		var ssh_args = [ 
			"-l",
			pkg.user, 
			pkg.host, 
			//"\"" + findparams.join(" ") + "\""
			findparams.join(" ") 
		];
		l(ssh_args);
		return self._run_ssh( ssh_args , function(err,out){
			if ( err ) return cb(err);
			if ( !out ) return cb(null,[]);

			var lines = out.split(/\n/);
			if ( lines[lines.length-1] == "" ) lines.pop();
			l(lines);

			return cb(null,lines); //array of full paths of files
		});


	}

	/*
		make best guess of the kind of file we're dealing with basd on the first few bytes

		returns pkg = {
			path_to_local: "..",
			filetype: ".." 
		}
	*/
	this.guess_file_type = function( from, cb ){
		from = self._parse_smartpath( from );
		if ( from.kind=="local" ){
			return self._guess_file_type(from.path, function(err, data){
				return cb(err, data);
			});
		}

		var path_to_local_fn= "/tmp/"  + (new Date()).getTime().toString() + "_" + from.path.split("/").pop();
		self.tmp_files_to_clear.push( path_to_local_fn );
		return self.copy( from, path_to_local_fn, function(err){
			if( err ){ 
				l("Got error attempting to copy from " , from , " to " , path_to_local_fn);
				return cb(err);
			}

			l("path_to_local:", path_to_local_fn);
			return self._guess_file_type(path_to_local_fn, cb);
		});
	}

	this._guess_file_type = function( path_to_local, cb ){
		var num_of_bytes = 3;
		var buf = new Buffer(num_of_bytes);		
		var pkg = { 
			path_to_local: path_to_local ,
			filetype: "na",
			hex: null
		};
		fs.open(path_to_local, "r", function( err, fd ){

			if ( err ){
				l("Got error trying to open local file: ", path_to_local, err);
				return cb({ "msg": "Got error trying opening file " + path_to_local, err: err});
			}

			fs.read(fd, buf, 0, num_of_bytes , null, function(err2, bytesRead, filled_buf){
				if ( err2 ){
					return cb({ "msg": "Got error trying to read first 3 bytes of " + path_to_local, err: err2});
				}
				//stringify the hex version of the first 3 bytes
				var as_hex = [];
				for(var i = 0; i < num_of_bytes; i++){
					as_hex.push(  ( filled_buf[i] ).toString(16) );
				}
				as_hex = as_hex.join("");
				pkg.hex = as_hex;
				switch( as_hex ){
					case "3c3f78":  // <?x  -> xml
						pkg.filetype = "xml";	
						break;
					case "495341":  // ISA -> edi 
						pkg.filetype = "edi";	
						break;
					case "49492a":
					case "4d4d0":
						pkg.filetype = "tif";
						break;
				}
				//l("guesspkg:", pkg);
				fs.close(fd, function(){
					return cb(null, pkg);
				});
			});
		});
	}


}



