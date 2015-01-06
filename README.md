File transfer utility

API:

read( pkg|smartpath, cb )
  if file is remote:
    executes copy to local tmp, 
    fs.read on the tmp file,
    deletes the tmp file

  returns cb(err, data);

write( data, pkg|smartpath [, opts ] , cb )
  if file is remote
    writes to tmp file, 
    copy tmp to remote
    deletes tmp file 

  returns cb(err);
  
delete( pkg|smartpath, [, opts], cb )
  if file is remote, 
    spawns ssh rm

  returns cb(err);


move( from_pkg|from_path,  to_pkg|to_path, [, opts ], cb )
  convenience method 
    copy, 
    delete the from

  returns cb(err);



copy( from_pkg|from_path,  to_pkg|to_path, [, opts ], cb )

from 		to
----		---
local	 	local


( local to remote )
local 		ssh
  

local 		pem

local 		ftp


( remote to local )
ssh			local
pem			local
ftp			local


( remote to remote )
ssh			ssh   	->  requries scp -3 (flag) 
ssh			pem		->  requries copy to local tmp first, then transfer back up
ssh			ftp		->  

pem			ssh		->  requries copy to local tmp first, then transfer back up
pem			pem		->  requries copy to local tmp first, then transfer back up
pem			ftp		

ftp			ssh
ftp			pem
ftp			ftp

