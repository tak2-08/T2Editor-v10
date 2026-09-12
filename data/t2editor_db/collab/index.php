<?php
http_response_code(404);
header('Cache-Control: no-store');
exit('Not Found');
